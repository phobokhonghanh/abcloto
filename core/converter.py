def number_to_vietnamese(num: int) -> str:
    """
    Converts a number (0-99) to Vietnamese text in a short "loto" style.
    Example: 28 -> "hai tám"
    Example: 5 -> "năm"
    Example: 10 -> "mười"
    Example: 15 -> "mười lăm"
    """
    if not 0 <= num <= 99:
        raise ValueError("Number must be between 0 and 99")

    digits = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"]
    
    if num < 10:
        return digits[num]
    
    tens = num // 10
    units = num % 10
    
    tens_str = digits[tens]
    units_str = digits[units]

    # Handle special cases
    if tens == 1:
        tens_str = "mười" # 10-19 -> mười ...
    
    if units == 0:
        if tens == 1:
            return "mười"
        return f"{tens_str} mươi" # 20, 30 -> hai mươi, ba mươi

    if units == 1:
        if tens > 1:
            units_str = "mốt" # 21 -> hai mốt
    
    if units == 5:
        if tens > 0:
            units_str = "lăm" # 15, 25 -> mười lăm, hai lăm

    # Loto style preference: often omits "mươi" for >20 if not round
    # Rule provided: 28 -> "hai tám"
    # But standard is "hai mươi tám". 
    # Let's support the user request "hai tám".
    
    if tens > 1 and units > 0:
        # Override for strict "digit-digit" reading if that's what user wants for loto
        # But wait, "21" -> "hai mốt", "25" -> "hai lăm" sounds better than "hai một", "hai năm".
        # User example: 28 -> "hai tám". 
        # So it seems they want "Title Case" of reading digits? No, just short form.
        # "hai mươi tám" -> "hai tám".
        return f"{digits[tens]} {units_str}"

    return f"{tens_str} {units_str}"

def normalize_text(text: str) -> str:
    """
    Normalize text for searching.
    - Lowercase
    - Remove punctuation
    """
    import string
    text = text.lower()
    # Remove common punctuation
    for char in string.punctuation:
        text = text.replace(char, " ")
    return " ".join(text.split())
